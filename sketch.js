  // --- textmode.js setup ---
  const t = textmode.create({
    width: window.innerWidth,
    height: window.innerHeight,
    fontSize: 16,
    frameRate: 60,
  });
  
  let img;
  let fbIn, fbOut;
  let paletteShader;
  
  // UI state
  let bins = 6; // 2..8

  let fbCal;
  let sigPerBin = new Array(8).fill(0);   // float sig = r + 256*g
  let calNeeded = true;
  //let calStep = 0;

  // Optimisation pour ne pas recalibrer les bins en même temps
  let calQueue = []; // ex: [3, 0, 5]
  //let calCurrent = -1;

  // Etats dérivés
  let useSig = true;
  let charsetCached = '';
  let paletteFGUniform = null;
  let paletteBGUniform = null;
  let paletteDirty = true;
  let charsetDirty = true;
  let sigModeDirty = true;

  let sigUniform = new Float32Array(8);

  
  let paletteFGHex = [
    '#0b1020', '#1b3a57', '#2a9d8f', '#e9c46a',
    '#f4a261', '#e76f51', '#f2f2f2', '#ffffff'
  ];
  
  let paletteBGHex = [
    '#05060c', '#0d1b2a', '#0b3b35', '#3a2e10',
    '#3a1d12', '#2a0d14', '#111111', '#000000'
  ];
  
  let binChars = ['·', '.', ':', '-', '=', '+', '*', '#']; // 8 max, dark -> bright
  

  
  t.setup(async () => {
    wireUI();
  
    img = await t.loadImage('./assets/image.png');
  
    // Ces méthodes existent sur TextmodeImage (pas sur "t")
    img.charColorMode("sampled");
    img.cellColorMode("sampled");
  
    fbIn  = t.createFramebuffer({ width: t.grid.cols, height: t.grid.rows });
    fbOut = t.createFramebuffer({ width: t.grid.cols, height: t.grid.rows });
    fbCal = t.createFramebuffer({ width: t.grid.cols, height: t.grid.rows });
    requestCalibrationAll();
  
    paletteShader = await t.createFilterShader('./palette_by_luma.frag');

    
  });
  
  t.draw(() => {
    if (!img || !paletteShader) return;
    rebuildDerivedState(false);

    // PASS 1
    fbIn.begin();
    t.clear();
    img.characters(charsetCached);
    t.image(img);
    fbIn.end();

    // Calibration step ensuite (offscreen)
    if (calNeeded) {
    runCalibrationStep();
    t.background(0);
    t.image(fbIn);   // rendu stable pendant cal
    return;
    }
  
    // PASS 2
    fbOut.begin();
    t.shader(paletteShader);
  
    t.setUniform('u_gridSize', [fbIn.width, fbIn.height]);
    t.setUniform('u_charTex', fbIn.textures[0]);
    t.setUniform('u_fgTex', fbIn.textures[1]);
    t.setUniform('u_bgTex', fbIn.textures[2]);
  
    t.setUniform('u_bins', clamp(bins, 2, 8));

    t.setUniform('u_sig', sigPerBin.map(v => Number(v)));

    t.setUniform('u_paletteFG', paletteFGUniform);
    t.setUniform('u_paletteBG', paletteBGUniform);
    t.setUniform('u_useSig', useSig ? 1 : 0);
  
    t.rect(t.grid.cols, t.grid.rows);
    fbOut.end();

  
    // AFFICHAGE
    t.background(0);
    t.image(fbOut);
  });

  

  // HELPERS

  // --- Helpers UI ---
function hexToRgb01(hex) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return [r / 255, g / 255, b / 255];
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }


function getCharsetForBins(bins) {
  return binChars
    .slice(0, bins)
    .map(ch => Array.from(ch)[0] ?? ' ')
    .join('');
}

function buildPaletteUI() {
  const sw = document.getElementById('swatches');
  sw.innerHTML = '';

  for (let i = 0; i < 8; i++) {
    const div = document.createElement('div');
    div.className = 'sw';

    const label = document.createElement('code');
    label.textContent = `bin ${i}`;

    const fg = document.createElement('input');
    fg.type = 'color';
    fg.value = paletteFGHex[i];
    fg.title = 'Texte (FG)';
    fg.addEventListener('input', () => {
      paletteFGHex[i] = fg.value;
      paletteDirty = true;
    });

    const bg = document.createElement('input');
    bg.type = 'color';
    bg.value = paletteBGHex[i];
    bg.title = 'Fond (BG)';
    bg.addEventListener('input', () => {
      paletteBGHex[i] = bg.value;
      paletteDirty = true;
    });

    const ch = document.createElement('input');
    ch.type = 'text';
    ch.value = binChars[i];
    ch.maxLength = 2;
    ch.size = 2;
    ch.title = 'Caractère';
    ch.style.width = '34px';
    ch.addEventListener('input', () => {
      const v = Array.from(ch.value)[0] ?? ' ';
      binChars[i] = v;
      ch.value = v;
      charsetDirty = true;
      sigModeDirty = true;
      requestCalibrationBin(i);
    });

    div.appendChild(label);
    div.appendChild(fg);
    div.appendChild(bg);
    div.appendChild(ch);
    sw.appendChild(div);
  }
}

function paletteHexToUniform(paletteHex) {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const [r, g, b] = hexToRgb01(paletteHex[i]);
    out.push(r, g, b);
  }
  return out;
}

function wireUI() {
  const binsEl = document.getElementById('bins');
  const binsValEl = document.getElementById('binsVal');

  binsEl.addEventListener('input', () => {
    bins = parseInt(binsEl.value, 10);
    binsValEl.textContent = String(bins);
    charsetDirty = true;
    sigModeDirty = true;
    requestCalibrationAll();
  });

  buildPaletteUI();
}



  function requestCalibrationAll() {
    // met à jour useSig/charset/palettes si nécessaire
    rebuildDerivedState();

    if (!useSig) {            // doublons => mode luma
      calQueue = [];
      calNeeded = false;
      return;
    }

    const b = clamp(bins, 2, 8);
    calQueue = [];
    for (let i = 0; i < b; i++) calQueue.push(i);
    calNeeded = true;
  }
  
  function requestCalibrationBin(i) {
    rebuildDerivedState();

    if (!useSig) {
      calQueue = [];
      calNeeded = false;
      return;
    }

    const b = clamp(bins, 2, 8);
    if (i < 0 || i >= b) return;
    if (!calQueue.includes(i)) calQueue.push(i);
    calNeeded = true;
  }


  function extractSignatureFromPixels(pixels, w, h) {
    // prend le pixel au centre
    const x = Math.floor(w / 2);
    const y = Math.floor(h / 2);
    const idx = (y * w + x) * 4;
  
    const r = pixels[idx + 0];
    const g = pixels[idx + 1];
    return r + 256 * g;
  }
  
  function charsetForSingleGlyph(glyph) {
    // on s’assure d’un seul "caractère" Unicode
    return Array.from(glyph)[0] ?? ' ';
  }
  
  // Calibre une signature par bin, sans rien afficher
  function runCalibrationStep() {
    if (!img || !fbCal) return;
  
    if (calQueue.length === 0) {
      calNeeded = false;
      img.characters(charsetCached);
      return;
    }
  
    const i = calQueue.shift(); // bin à calibrer ce frame
    const glyph = charsetForSingleGlyph(binChars[i] ?? ' ');
    img.characters(glyph);
  
    fbCal.begin();
    t.clear();
    t.image(img);
    fbCal.end();
  
    const px = fbCal.readPixels(0);
    const sig = extractSignatureFromPixels(px, fbCal.width, fbCal.height);
  
    // 🔹 C’EST ICI
    sigPerBin[i] = sig;      // côté JS (debug / logique)
    sigUniform[i] = sig;     // côté shader (uniform stable)
  }
  
  

  function hasDuplicateGlyphs(bins) {
    const b = clamp(bins, 2, 8);
    const seen = new Set();
    for (let i = 0; i < b; i++) {
      const g = Array.from(binChars[i] ?? ' ')[0] ?? ' ';
      const key = g; // Unicode OK (on compare les strings)
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  }


  function rebuildDerivedState(force = false) {
    if (force || sigModeDirty) {
      useSig = !hasDuplicateGlyphs(bins);
      sigModeDirty = false;
    }
  
    if (force || charsetDirty) {
      charsetCached = getCharsetForBins(bins);
      charsetDirty = false;
    }
  
    if (force || paletteDirty) {
      paletteFGUniform = paletteHexToUniform(paletteFGHex);
      paletteBGUniform = paletteHexToUniform(paletteBGHex);
      paletteDirty = false;
    }
  }

  
  t.windowResized(() => {
    t.resizeCanvas(window.innerWidth, window.innerHeight);
    if (fbIn) fbIn.resize(t.grid.cols, t.grid.rows);
    if (fbOut) fbOut.resize(t.grid.cols, t.grid.rows);
    if (fbCal) fbCal.resize(t.grid.cols, t.grid.rows);
    requestCalibrationAll();
  });
  