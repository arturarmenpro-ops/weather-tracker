// Изобары: линии равного давления по сетке (marching squares) — рисуются поверх заливки карты.
(function () {
  const WT = (window.WT = window.WT || {});

  // vals — массив nx*ny (строки с севера на юг), levels — значения линий.
  // Возвращает {level: [[x1,y1,x2,y2], ...]} в координатах сетки (x — столбец, y — строка).
  WT.contours = function (vals, nx, ny, levels) {
    const out = {};
    for (const lv of levels) out[lv] = [];
    const lerp = (a, b, va, vb, lv) => a + ((lv - va) / (vb - va)) * (b - a);
    for (let r = 0; r < ny - 1; r++) {
      for (let c = 0; c < nx - 1; c++) {
        const a = vals[r * nx + c], b = vals[r * nx + c + 1], d = vals[(r + 1) * nx + c], e = vals[(r + 1) * nx + c + 1];
        if (a == null || b == null || d == null || e == null) continue;
        const lo = Math.min(a, b, d, e), hi = Math.max(a, b, d, e);
        for (const lv of levels) {
          if (lv < lo || lv > hi) continue;
          // точки пересечения уровня с рёбрами клетки: верх (a-b), право (b-e), низ (d-e), лево (a-d)
          const pts = [];
          if ((a < lv) !== (b < lv)) pts.push([lerp(c, c + 1, a, b, lv), r]);
          if ((b < lv) !== (e < lv)) pts.push([c + 1, lerp(r, r + 1, b, e, lv)]);
          if ((d < lv) !== (e < lv)) pts.push([lerp(c, c + 1, d, e, lv), r + 1]);
          if ((a < lv) !== (d < lv)) pts.push([c, lerp(r, r + 1, a, d, lv)]);
          if (pts.length === 2) out[lv].push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
          else if (pts.length === 4) { // седловина: соединяем по среднему значению
            const mid = (a + b + d + e) / 4;
            if ((mid < lv) === (a < lv)) { out[lv].push([...pts[0], ...pts[1]]); out[lv].push([...pts[2], ...pts[3]]); }
            else { out[lv].push([...pts[0], ...pts[3]]); out[lv].push([...pts[1], ...pts[2]]); }
          }
        }
      }
    }
    return out;
  };

  // Сгладить поле: увеличить сетку в k раз (билинейно), чтобы линии были плавнее
  WT.upsample = function (vals, nx, ny, k) {
    const NX = (nx - 1) * k + 1, NY = (ny - 1) * k + 1, res = new Array(NX * NY);
    for (let R = 0; R < NY; R++) {
      const y = R / k, r0 = Math.min(Math.floor(y), ny - 2), fy = y - r0;
      for (let C = 0; C < NX; C++) {
        const x = C / k, c0 = Math.min(Math.floor(x), nx - 2), fx = x - c0;
        const a = vals[r0 * nx + c0], b = vals[r0 * nx + c0 + 1], d = vals[(r0 + 1) * nx + c0], e = vals[(r0 + 1) * nx + c0 + 1];
        res[R * NX + C] = a == null || b == null || d == null || e == null ? null
          : a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy;
      }
    }
    return { vals: res, nx: NX, ny: NY };
  };
})();
