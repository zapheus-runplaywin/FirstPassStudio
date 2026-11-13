// FirstPass Studio - the test pattern's script (testpattern.html loads it as a module, so its names stay its own).

// Line patches: white and black (opaque) lines of 1, 2 and 4 pixels, both ways.
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const holder = $('lines') as HTMLElement;
[1, 2, 4].forEach((w, i) => {
  for (const dir of ['90deg', '0deg']) {
    const el = document.createElement('div');
    el.className = 'lines';
    Object.assign(el.style, {
      left: `${40 + i * 460 + (dir === '0deg' ? 220 : 0)}px`, top: '160px',
      background: `repeating-linear-gradient(${dir}, #fff 0 ${w}px, #000 ${w}px ${w * 2}px)`,
    });
    holder.appendChild(el);
  }
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = `${w}-pixel lines`;
  Object.assign(label.style, { left: `${40 + i * 460}px`, top: '290px' });
  holder.appendChild(label);
});

// What makes this file a module (its names its own), as the first line says.
export {};
