// FirstPass Studio - the optional full-frame background behind a full-screen animation (logo.html, introoutro.html),
// from the page's link. Without these options the page stays see-through.
//   ?bg=gradient      the dark grey preview gradient
//   ?bg=7f4092        (or a colour name) a radial gradient from that colour in the middle to a darker shade at the edges;
//                     ?bg2= sets the edge colour
//   ?bg=solid-7f4092  a flat colour
//   ?bgimage=court.jpg a picture: a file in the competition's brand folder, or a full link
// studioBackdrop(box, params, label) styles box and shows it (box starts hidden); label starts its warnings.
/* exported studioBackdrop */
function studioBackdrop(box, params, label) {
  function colour(v) {
    if (!v) return null;
    v = v.trim();
    if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) v = '#' + v;
    return CSS.supports('color', v) ? v : null;
  }
  function darker(c) {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${Math.round(r * .3)}, ${Math.round(g * .3)}, ${Math.round(b * .3)})`;
  }
  const bg = (params.get('bg') || '').trim(), image = (params.get('bgimage') || '').trim();
  const layers = [];
  if (image) {
    const url = /[/:]/.test(image) ? image : '/brand/' + encodeURIComponent(image);
    layers.push(`url("${url.replace(/"/g, '%22')}")`);
  }
  if (bg) {
    const solid = bg.toLowerCase().startsWith('solid-') ? colour(bg.slice(6)) : null;
    const centre = bg.toLowerCase() === 'gradient' ? '#3a4250' : colour(bg);
    const edge = colour(params.get('bg2')) || (bg.toLowerCase() === 'gradient' ? '#15181d' : centre && darker(centre));
    if (solid) layers.push(`linear-gradient(${solid}, ${solid})`);
    else if (centre) layers.push(`radial-gradient(circle at 50% 40%, ${centre}, ${edge})`);
    else console.warn(`${label}: ?bg= is not a colour or "gradient":`, bg);
  }
  if (!layers.length) return;
  box.style.backgroundImage = layers.join(', ');
  box.hidden = false;
  if (image) { const test = new Image(); test.onerror = () => console.warn(`${label}: could not load the background image`, image); test.src = layers[0].slice(5, -2); }
}
