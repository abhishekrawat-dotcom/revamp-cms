import type { InfographicData } from '../types/bookstudio';

function esc(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paletteFor(data: InfographicData, index: number): string {
  const itemColor = data.items[index]?.color;
  if (itemColor) return itemColor;
  const cycle = [
    data.accentColor || '#B5894C',
    data.secondaryColor || '#3D5A5C',
    '#7D5A50',
    '#4A5568',
    '#8C6D46',
    '#2F4858',
  ];
  return cycle[index % cycle.length];
}

/**
 * Generates a crisp, resolution-independent vector SVG string for any of the 52 infographic templates.
 * Reactively reflects every edit to titles, labels, values, units, categories, colors, and fonts.
 */
export function renderInfographicToSvgString(
  data: InfographicData,
  width = 640,
  height = 420
): string {
  const W = Math.max(320, width);
  const H = Math.max(220, height);
  const bg = data.backgroundColor || '#F7F4EE';
  const ink = data.textColor || '#1C1917';
  const accent = data.accentColor || '#A67C46';
  const secondary = data.secondaryColor || '#385258';
  const font = data.fontFamily || 'Plus Jakarta Sans';
  const items = data.items.length > 0 ? data.items : [];
  const maxVal = Math.max(1, ...items.map((it) => Math.abs(it.value || 0)));

  const padX = 28;
  const headerH = 74;
  const footerH = 26;
  const bodyY = headerH + 8;
  const bodyH = H - headerH - footerH - 16;
  const bodyW = W - padX * 2;

  let bodySvg = '';

  switch (data.variant) {
    case 'kpi_grid':
    case 'stat_highlights':
    case 'impact_scorecard': {
      const cols = Math.min(3, Math.max(2, Math.ceil(items.length / 2)));
      const rows = Math.ceil(items.length / cols);
      const gap = 12;
      const cardW = (bodyW - gap * (cols - 1)) / cols;
      const cardH = (bodyH - gap * (rows - 1)) / Math.max(1, rows);
      items.forEach((it, idx) => {
        const c = idx % cols;
        const r = Math.floor(idx / cols);
        const cx = padX + c * (cardW + gap);
        const cy = bodyY + r * (cardH + gap);
        const col = paletteFor(data, idx);
        bodySvg += `
          <rect x="${cx}" y="${cy}" width="${cardW}" height="${cardH}" rx="2" fill="${ink}" fill-opacity="0.035" stroke="${ink}" stroke-opacity="0.12" stroke-width="1"/>
          <line x1="${cx}" y1="${cy}" x2="${cx + cardW}" y2="${cy}" stroke="${col}" stroke-width="2.5"/>
          <text x="${cx + 14}" y="${cy + 24}" font-size="10" fill="${ink}" fill-opacity="0.6" font-weight="600" letter-spacing="0.06em">${esc((it.category || it.label).toUpperCase().slice(0, 22))}</text>
          <text x="${cx + 14}" y="${cy + cardH * 0.62}" font-size="${Math.min(30, cardH * 0.34)}" fill="${col}" font-weight="700">${esc(`${it.value}${it.unit || ''}`)}</text>
          <text x="${cx + 14}" y="${cy + cardH - 14}" font-size="10.5" fill="${ink}" fill-opacity="0.75">${esc((it.description || it.label).slice(0, 32))}</text>
        `;
      });
      break;
    }

    case 'horizontal_bars':
    case 'survey_bars':
    case 'regional_bars': {
      const rowH = Math.min(44, bodyH / Math.max(1, items.length));
      const labelW = Math.min(155, bodyW * 0.33);
      const barAreaW = bodyW - labelW - 58;
      items.forEach((it, idx) => {
        const ry = bodyY + idx * rowH + 6;
        const barW = Math.max(6, (Math.abs(it.value) / maxVal) * barAreaW);
        const col = paletteFor(data, idx);
        bodySvg += `
          <text x="${padX}" y="${ry + 16}" font-size="11" fill="${ink}" font-weight="500">${esc(it.label.slice(0, 24))}</text>
          <rect x="${padX + labelW}" y="${ry + 5}" width="${barAreaW}" height="${Math.min(18, rowH - 14)}" rx="1" fill="${ink}" fill-opacity="0.07"/>
          <rect x="${padX + labelW}" y="${ry + 5}" width="${barW}" height="${Math.min(18, rowH - 14)}" rx="1" fill="${col}"/>
          ${data.showValues ? `<text x="${padX + labelW + barW + 8}" y="${ry + 18}" font-size="11" fill="${ink}" font-weight="700">${esc(`${it.value}${it.unit || ''}`)}</text>` : ''}
        `;
      });
      break;
    }

    case 'vertical_bars': {
      const n = Math.max(1, items.length);
      const gap = 14;
      const barW = Math.min(52, (bodyW - gap * (n - 1)) / n);
      const startX = padX + (bodyW - (barW * n + gap * (n - 1))) / 2;
      const chartBottom = bodyY + bodyH - 28;
      const chartH = bodyH - 48;
      bodySvg += `<line x1="${padX}" y1="${chartBottom}" x2="${padX + bodyW}" y2="${chartBottom}" stroke="${ink}" stroke-opacity="0.2" stroke-width="1"/>`;
      items.forEach((it, idx) => {
        const bx = startX + idx * (barW + gap);
        const bh = Math.max(6, (Math.abs(it.value) / maxVal) * chartH);
        const by = chartBottom - bh;
        const col = paletteFor(data, idx);
        bodySvg += `
          <rect x="${bx}" y="${by}" width="${barW}" height="${bh}" rx="1.5" fill="${col}"/>
          ${data.showValues ? `<text x="${bx + barW / 2}" y="${by - 6}" text-anchor="middle" font-size="10.5" fill="${ink}" font-weight="700">${esc(`${it.value}${it.unit || ''}`)}</text>` : ''}
          <text x="${bx + barW / 2}" y="${chartBottom + 16}" text-anchor="middle" font-size="10" fill="${ink}" fill-opacity="0.75">${esc(it.label.slice(0, 14))}</text>
        `;
      });
      break;
    }

    case 'donut_ring':
    case 'carbon_breakdown': {
      const total = Math.max(1, items.reduce((s, i) => s + Math.max(0.1, i.value), 0));
      const r = Math.min(bodyH * 0.4, bodyW * 0.22);
      const cx = padX + r + 24;
      const cy = bodyY + bodyH / 2;
      const circ = 2 * Math.PI * r;
      let offset = 0;
      items.forEach((it, idx) => {
        const frac = Math.max(0.01, it.value) / total;
        const dash = frac * circ;
        const col = paletteFor(data, idx);
        bodySvg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="${Math.max(16, r * 0.34)}" stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
        offset += dash;
      });
      bodySvg += `
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="18" fill="${ink}" font-weight="700">${esc(String(Math.round(total)))}${esc(items[0]?.unit || '')}</text>
        <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="9.5" fill="${ink}" fill-opacity="0.6">TOTAL</text>
      `;
      const lx = cx + r + 38;
      items.forEach((it, idx) => {
        const ly = bodyY + 18 + idx * Math.min(34, (bodyH - 20) / Math.max(1, items.length));
        const pct = Math.round((it.value / total) * 100);
        bodySvg += `
          <rect x="${lx}" y="${ly - 9}" width="10" height="10" rx="1" fill="${paletteFor(data, idx)}"/>
          <text x="${lx + 18}" y="${ly}" font-size="11.5" fill="${ink}" font-weight="500">${esc(it.label.slice(0, 22))}</text>
          <text x="${padX + bodyW}" y="${ly}" text-anchor="end" font-size="11" fill="${ink}" font-weight="700">${esc(`${it.value}${it.unit || ''}`)} (${pct}%)</text>
        `;
      });
      break;
    }

    case 'radial_gauges': {
      const n = Math.max(1, Math.min(4, items.length));
      const slotW = bodyW / n;
      const r = Math.min(44, slotW * 0.34, bodyH * 0.32);
      const circ = 2 * Math.PI * r;
      items.slice(0, 4).forEach((it, idx) => {
        const cx = padX + slotW * idx + slotW / 2;
        const cy = bodyY + bodyH * 0.44;
        const pct = Math.min(100, Math.max(5, it.unit === '%' ? it.value : (it.value / maxVal) * 100));
        const dash = (pct / 100) * circ;
        const col = paletteFor(data, idx);
        bodySvg += `
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ink}" stroke-opacity="0.1" stroke-width="9"/>
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="9" stroke-dasharray="${dash} ${circ - dash}" stroke-linecap="butt" transform="rotate(-90 ${cx} ${cy})"/>
          <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="15" fill="${ink}" font-weight="700">${esc(`${it.value}${it.unit || ''}`)}</text>
          <text x="${cx}" y="${cy + r + 24}" text-anchor="middle" font-size="10.5" fill="${ink}" font-weight="600">${esc(it.label.slice(0, 18))}</text>
          <text x="${cx}" y="${cy + r + 38}" text-anchor="middle" font-size="9.5" fill="${ink}" fill-opacity="0.6">${esc((it.description || '').slice(0, 22))}</text>
        `;
      });
      break;
    }

    case 'line_trend': {
      const chartX = padX + 26;
      const chartW = bodyW - 44;
      const chartY = bodyY + 14;
      const chartH = bodyH - 48;
      // Grid lines
      for (let g = 0; g <= 3; g++) {
        const gy = chartY + (chartH / 3) * g;
        bodySvg += `<line x1="${chartX}" y1="${gy}" x2="${chartX + chartW}" y2="${gy}" stroke="${ink}" stroke-opacity="0.1" stroke-dasharray="3 3"/>`;
      }
      const pts = items.map((it, idx) => {
        const px = chartX + (idx / Math.max(1, items.length - 1)) * chartW;
        const py = chartY + chartH - (Math.abs(it.value) / maxVal) * chartH;
        return { x: px, y: py, it };
      });
      const poly = pts.map((p) => `${p.x},${p.y}`).join(' ');
      const area = `${chartX},${chartY + chartH} ${poly} ${chartX + chartW},${chartY + chartH}`;
      bodySvg += `<polygon points="${area}" fill="${accent}" fill-opacity="0.12"/>`;
      bodySvg += `<polyline points="${poly}" fill="none" stroke="${accent}" stroke-width="2.5"/>`;
      pts.forEach((p) => {
        bodySvg += `
          <circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${bg}" stroke="${accent}" stroke-width="2.2"/>
          <text x="${p.x}" y="${p.y - 10}" text-anchor="middle" font-size="10" fill="${ink}" font-weight="700">${esc(`${p.it.value}${p.it.unit || ''}`)}</text>
          <text x="${p.x}" y="${chartY + chartH + 18}" text-anchor="middle" font-size="9.5" fill="${ink}" fill-opacity="0.7">${esc((p.it.yearOrStep || p.it.label).slice(0, 12))}</text>
        `;
      });
      break;
    }

    case 'horizontal_timeline':
    case 'milestone_zigzag':
    case 'journey_arc': {
      const midY = bodyY + bodyH * 0.5;
      bodySvg += `<line x1="${padX + 16}" y1="${midY}" x2="${padX + bodyW - 16}" y2="${midY}" stroke="${accent}" stroke-width="2"/>`;
      const n = Math.max(1, items.length);
      const stepW = (bodyW - 32) / Math.max(1, n - 1 || 1);
      items.forEach((it, idx) => {
        const px = n === 1 ? padX + bodyW / 2 : padX + 16 + idx * stepW;
        const above = data.variant === 'horizontal_timeline' ? true : idx % 2 === 0;
        const textY = above ? midY - 46 : midY + 28;
        const col = paletteFor(data, idx);
        bodySvg += `
          <line x1="${px}" y1="${midY}" x2="${px}" y2="${above ? midY - 18 : midY + 18}" stroke="${col}" stroke-width="1.5"/>
          <circle cx="${px}" cy="${midY}" r="6" fill="${col}" stroke="${bg}" stroke-width="2"/>
          <text x="${px}" y="${textY}" text-anchor="middle" font-size="11.5" fill="${col}" font-weight="700">${esc(it.yearOrStep || String(it.value))}</text>
          <text x="${px}" y="${textY + 14}" text-anchor="middle" font-size="10" fill="${ink}" font-weight="600">${esc(it.label.slice(0, 16))}</text>
          <text x="${px}" y="${textY + 27}" text-anchor="middle" font-size="9" fill="${ink}" fill-opacity="0.65">${esc((it.description || '').slice(0, 20))}</text>
        `;
      });
      break;
    }

    case 'vertical_timeline':
    case 'roadmap_tracks':
    case 'phased_gantt': {
      const railX = padX + 76;
      bodySvg += `<line x1="${railX}" y1="${bodyY + 10}" x2="${railX}" y2="${bodyY + bodyH - 10}" stroke="${accent}" stroke-width="1.8"/>`;
      const rowH = bodyH / Math.max(1, items.length);
      items.forEach((it, idx) => {
        const cy = bodyY + idx * rowH + rowH * 0.45;
        const col = paletteFor(data, idx);
        const barW = Math.max(40, (Math.abs(it.value) / maxVal) * (bodyW - 140));
        bodySvg += `
          <text x="${railX - 14}" y="${cy + 4}" text-anchor="end" font-size="11" fill="${col}" font-weight="700">${esc(it.yearOrStep || `P${idx + 1}`)}</text>
          <circle cx="${railX}" cy="${cy}" r="5" fill="${col}" stroke="${bg}" stroke-width="2"/>
          ${
            data.variant === 'phased_gantt'
              ? `<rect x="${railX + 18 + idx * 18}" y="${cy - 9}" width="${Math.min(bodyW - 110 - idx * 18, barW)}" height="18" rx="2" fill="${col}" fill-opacity="0.85"/>
                 <text x="${railX + 24 + idx * 18}" y="${cy + 4}" font-size="9.5" fill="#FFFFFF" font-weight="600">${esc(it.label.slice(0, 22))}</text>`
              : `<text x="${railX + 18}" y="${cy + 2}" font-size="11.5" fill="${ink}" font-weight="600">${esc(it.label.slice(0, 34))}</text>
                 <text x="${railX + 18}" y="${cy + 16}" font-size="9.5" fill="${ink}" fill-opacity="0.68">${esc((it.description || '').slice(0, 56))}</text>`
          }
        `;
      });
      break;
    }

    case 'process_steps':
    case 'linear_pipeline':
    case 'value_chain':
    case 'ai_workflow': {
      const n = Math.max(1, items.length);
      const gap = 10;
      const boxW = (bodyW - gap * (n - 1)) / n;
      const boxH = Math.min(130, bodyH * 0.72);
      const topY = bodyY + (bodyH - boxH) / 2;
      items.forEach((it, idx) => {
        const bx = padX + idx * (boxW + gap);
        const col = paletteFor(data, idx);
        bodySvg += `
          <rect x="${bx}" y="${topY}" width="${boxW}" height="${boxH}" rx="2" fill="${col}" fill-opacity="0.1" stroke="${col}" stroke-width="1.2"/>
          <rect x="${bx}" y="${topY}" width="${boxW}" height="24" fill="${col}"/>
          <text x="${bx + 10}" y="${topY + 16}" font-size="10" fill="#FFFFFF" font-weight="700">${esc(it.yearOrStep || `0${idx + 1}`)}</text>
          <text x="${bx + 10}" y="${topY + 46}" font-size="11" fill="${ink}" font-weight="700">${esc(it.label.slice(0, 15))}</text>
          <text x="${bx + 10}" y="${topY + 64}" font-size="9.5" fill="${ink}" fill-opacity="0.72">${esc((it.description || '').slice(0, 22))}</text>
          ${data.showValues ? `<text x="${bx + 10}" y="${topY + boxH - 12}" font-size="11" fill="${col}" font-weight="700">${esc(`${it.value}${it.unit || ''}`)}</text>` : ''}
          ${idx < n - 1 ? `<polygon points="${bx + boxW + 2},${topY + boxH / 2 - 5} ${bx + boxW + gap - 1},${topY + boxH / 2} ${bx + boxW + 2},${topY + boxH / 2 + 5}" fill="${col}"/>` : ''}
        `;
      });
      break;
    }

    case 'circular_workflow':
    case 'lifecycle_ring':
    case 'concentric_ecosystem': {
      const cx = padX + bodyW / 2;
      const cy = bodyY + bodyH / 2;
      const R = Math.min(bodyW, bodyH) * 0.34;
      bodySvg += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${accent}" stroke-width="1.8" stroke-dasharray="4 4"/>`;
      bodySvg += `<circle cx="${cx}" cy="${cy}" r="${R * 0.42}" fill="${accent}" fill-opacity="0.12" stroke="${accent}" stroke-width="1.2"/>`;
      bodySvg += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="10" fill="${ink}" font-weight="700">${esc(data.categoryLabel.slice(0, 14).toUpperCase())}</text>`;
      const n = Math.max(1, items.length);
      items.forEach((it, idx) => {
        const ang = (idx / n) * Math.PI * 2 - Math.PI / 2;
        const nx = cx + Math.cos(ang) * R;
        const ny = cy + Math.sin(ang) * R;
        const col = paletteFor(data, idx);
        bodySvg += `
          <circle cx="${nx}" cy="${ny}" r="18" fill="${col}" stroke="${bg}" stroke-width="2.5"/>
          <text x="${nx}" y="${ny + 4}" text-anchor="middle" font-size="10" fill="#FFFFFF" font-weight="700">${idx + 1}</text>
          <text x="${cx + Math.cos(ang) * (R + 40)}" y="${cy + Math.sin(ang) * (R + 28) + 4}" text-anchor="middle" font-size="10" fill="${ink}" font-weight="600">${esc(it.label.slice(0, 16))}</text>
        `;
      });
      break;
    }

    case 'swot_matrix':
    case 'business_canvas':
    case 'market_quadrant':
    case 'stakeholder_map': {
      const halfW = (bodyW - 12) / 2;
      const halfH = (bodyH - 12) / 2;
      items.slice(0, 4).forEach((it, idx) => {
        const c = idx % 2;
        const r = Math.floor(idx / 2);
        const qx = padX + c * (halfW + 12);
        const qy = bodyY + r * (halfH + 12);
        const col = paletteFor(data, idx);
        bodySvg += `
          <rect x="${qx}" y="${qy}" width="${halfW}" height="${halfH}" rx="2" fill="${col}" fill-opacity="0.08" stroke="${col}" stroke-opacity="0.35" stroke-width="1"/>
          <text x="${qx + 14}" y="${qy + 22}" font-size="11.5" fill="${col}" font-weight="700">${esc(it.label.toUpperCase().slice(0, 22))}</text>
          <text x="${qx + 14}" y="${qy + 42}" font-size="10" fill="${ink}" fill-opacity="0.8">${esc((it.description || '').slice(0, 42))}</text>
          ${data.showValues ? `<text x="${qx + halfW - 14}" y="${qy + 22}" text-anchor="end" font-size="11" fill="${ink}" font-weight="700">${esc(`${it.value}${it.unit || ''}`)}</text>` : ''}
        `;
      });
      break;
    }

    case 'before_after':
    case 'two_col_comparison':
    case 'pros_cons':
    case 'feature_matrix': {
      const halfW = (bodyW - 16) / 2;
      const leftItems = items.filter((_, i) => i % 2 === 0);
      const rightItems = items.filter((_, i) => i % 2 === 1);
      const leftTitle = data.variant === 'before_after' ? 'BEFORE' : data.variant === 'pros_cons' ? 'ADVANTAGES' : 'COLUMN A';
      const rightTitle = data.variant === 'before_after' ? 'AFTER' : data.variant === 'pros_cons' ? 'CONSIDERATIONS' : 'COLUMN B';

      bodySvg += `
        <rect x="${padX}" y="${bodyY}" width="${halfW}" height="${bodyH}" rx="2" fill="${ink}" fill-opacity="0.03" stroke="${ink}" stroke-opacity="0.14"/>
        <rect x="${padX}" y="${bodyY}" width="${halfW}" height="28" fill="${secondary}"/>
        <text x="${padX + 12}" y="${bodyY + 18}" font-size="10.5" fill="#FFFFFF" font-weight="700" letter-spacing="0.08em">${leftTitle}</text>

        <rect x="${padX + halfW + 16}" y="${bodyY}" width="${halfW}" height="${bodyH}" rx="2" fill="${accent}" fill-opacity="0.06" stroke="${accent}" stroke-opacity="0.3"/>
        <rect x="${padX + halfW + 16}" y="${bodyY}" width="${halfW}" height="28" fill="${accent}"/>
        <text x="${padX + halfW + 28}" y="${bodyY + 18}" font-size="10.5" fill="#FFFFFF" font-weight="700" letter-spacing="0.08em">${rightTitle}</text>
      `;

      leftItems.forEach((it, idx) => {
        const y = bodyY + 52 + idx * 38;
        bodySvg += `
          <text x="${padX + 12}" y="${y}" font-size="11" fill="${ink}" font-weight="600">${esc(it.label.slice(0, 24))}</text>
          <text x="${padX + halfW - 12}" y="${y}" text-anchor="end" font-size="11" fill="${secondary}" font-weight="700">${esc(`${it.value}${it.unit || ''}`)}</text>
          <text x="${padX + 12}" y="${y + 14}" font-size="9.5" fill="${ink}" fill-opacity="0.65">${esc((it.description || '').slice(0, 34))}</text>
        `;
      });
      rightItems.forEach((it, idx) => {
        const y = bodyY + 52 + idx * 38;
        bodySvg += `
          <text x="${padX + halfW + 28}" y="${y}" font-size="11" fill="${ink}" font-weight="600">${esc(it.label.slice(0, 24))}</text>
          <text x="${padX + bodyW - 12}" y="${y}" text-anchor="end" font-size="11" fill="${accent}" font-weight="700">${esc(`${it.value}${it.unit || ''}`)}</text>
          <text x="${padX + halfW + 28}" y="${y + 14}" font-size="9.5" fill="${ink}" fill-opacity="0.65">${esc((it.description || '').slice(0, 34))}</text>
        `;
      });
      break;
    }

    case 'org_hierarchy':
    case 'decision_tree': {
      const root = items[0];
      const children = items.slice(1, 5);
      const rootW = 180;
      const rootH = 42;
      const rx = padX + (bodyW - rootW) / 2;
      const ry = bodyY + 10;
      bodySvg += `
        <rect x="${rx}" y="${ry}" width="${rootW}" height="${rootH}" rx="2" fill="${accent}"/>
        <text x="${rx + rootW / 2}" y="${ry + 18}" text-anchor="middle" font-size="11" fill="#FFFFFF" font-weight="700">${esc((root?.label || 'Executive Board').slice(0, 24))}</text>
        <text x="${rx + rootW / 2}" y="${ry + 33}" text-anchor="middle" font-size="9.5" fill="#FFFFFF" fill-opacity="0.85">${esc((root?.description || '').slice(0, 28))}</text>
      `;
      const midY = ry + rootH + 26;
      bodySvg += `<line x1="${rx + rootW / 2}" y1="${ry + rootH}" x2="${rx + rootW / 2}" y2="${midY}" stroke="${ink}" stroke-opacity="0.35" stroke-width="1.5"/>`;
      const n = Math.max(1, children.length);
      const cGap = 12;
      const cW = (bodyW - cGap * (n - 1)) / n;
      const cY = midY + 20;
      if (n > 1) {
        bodySvg += `<line x1="${padX + cW / 2}" y1="${midY}" x2="${padX + bodyW - cW / 2}" y2="${midY}" stroke="${ink}" stroke-opacity="0.35" stroke-width="1.5"/>`;
      }
      children.forEach((ch, idx) => {
        const cx = padX + idx * (cW + cGap);
        const col = paletteFor(data, idx + 1);
        bodySvg += `
          <line x1="${cx + cW / 2}" y1="${midY}" x2="${cx + cW / 2}" y2="${cY}" stroke="${ink}" stroke-opacity="0.35" stroke-width="1.5"/>
          <rect x="${cx}" y="${cY}" width="${cW}" height="${Math.min(92, bodyH - 106)}" rx="2" fill="${col}" fill-opacity="0.1" stroke="${col}" stroke-width="1.2"/>
          <text x="${cx + cW / 2}" y="${cY + 22}" text-anchor="middle" font-size="10.5" fill="${ink}" font-weight="700">${esc(ch.label.slice(0, 16))}</text>
          <text x="${cx + cW / 2}" y="${cY + 42}" text-anchor="middle" font-size="13" fill="${col}" font-weight="700">${esc(`${ch.value}${ch.unit || ''}`)}</text>
          <text x="${cx + cW / 2}" y="${cY + 60}" text-anchor="middle" font-size="9" fill="${ink}" fill-opacity="0.7">${esc((ch.description || '').slice(0, 18))}</text>
        `;
      });
      break;
    }

    case 'strategy_pyramid':
    case 'innovation_funnel':
    case 'tech_stack': {
      const n = Math.max(1, items.length);
      const tierH = (bodyH - 12) / n;
      const isFunnel = data.variant === 'innovation_funnel';
      items.forEach((it, idx) => {
        const ratio = isFunnel ? 1 - idx * 0.14 : 0.4 + ((idx + 1) / n) * 0.6;
        const w = bodyW * Math.max(0.32, Math.min(1, ratio));
        const tx = padX + (bodyW - w) / 2;
        const ty = bodyY + idx * tierH + 4;
        const col = paletteFor(data, idx);
        bodySvg += `
          <rect x="${tx}" y="${ty}" width="${w}" height="${tierH - 6}" rx="2" fill="${col}"/>
          <text x="${tx + 14}" y="${ty + (tierH - 6) / 2 + 4}" font-size="11" fill="#FFFFFF" font-weight="700">${esc(it.label.slice(0, 26))}</text>
          <text x="${tx + w - 14}" y="${ty + (tierH - 6) / 2 + 4}" text-anchor="end" font-size="11" fill="#FFFFFF" font-weight="600">${esc(`${it.value}${it.unit || ''}`)}</text>
        `;
      });
      break;
    }

    case 'india_map_data':
    case 'world_map_data':
    case 'location_pins':
    case 'city_grid': {
      const mapW = bodyW * 0.56;
      const mapH = bodyH;
      bodySvg += `<rect x="${padX}" y="${bodyY}" width="${mapW}" height="${mapH}" rx="2" fill="${secondary}" fill-opacity="0.08" stroke="${ink}" stroke-opacity="0.14"/>`;
      if (data.variant === 'india_map_data') {
        // Stylized editorial India geometric cartographic silhouette
        bodySvg += `<path d="M${padX + mapW * 0.42},${bodyY + 18} L${padX + mapW * 0.58},${bodyY + 26} L${padX + mapW * 0.68},${bodyY + 55} L${padX + mapW * 0.84},${bodyY + 72} L${padX + mapW * 0.72},${bodyY + 110} L${padX + mapW * 0.58},${bodyY + 150} L${padX + mapW * 0.46},${bodyY + mapH - 18} L${padX + mapW * 0.34},${bodyY + 142} L${padX + mapW * 0.24},${bodyY + 95} L${padX + mapW * 0.35},${bodyY + 62} Z" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-width="1.5"/>`;
      } else {
        // Stylized world / regional grid latitudes & longitudes
        for (let i = 1; i <= 4; i++) {
          bodySvg += `<line x1="${padX}" y1="${bodyY + (mapH / 5) * i}" x2="${padX + mapW}" y2="${bodyY + (mapH / 5) * i}" stroke="${ink}" stroke-opacity="0.08"/>`;
          bodySvg += `<line x1="${padX + (mapW / 5) * i}" y1="${bodyY}" x2="${padX + (mapW / 5) * i}" y2="${bodyY + mapH}" stroke="${ink}" stroke-opacity="0.08"/>`;
        }
      }
      const coords = [
        [0.44, 0.28],
        [0.36, 0.54],
        [0.64, 0.42],
        [0.52, 0.74],
        [0.72, 0.65],
      ];
      items.slice(0, 5).forEach((it, idx) => {
        const [fx, fy] = coords[idx % coords.length];
        const px = padX + mapW * fx;
        const py = bodyY + mapH * fy;
        const r = Math.max(7, Math.min(20, (Math.abs(it.value) / maxVal) * 20));
        const col = paletteFor(data, idx);
        bodySvg += `
          <circle cx="${px}" cy="${py}" r="${r}" fill="${col}" fill-opacity="0.78" stroke="${bg}" stroke-width="1.8"/>
          <text x="${px}" y="${py + 3.5}" text-anchor="middle" font-size="8.5" fill="#FFFFFF" font-weight="700">${idx + 1}</text>
        `;
        const lx = padX + mapW + 16;
        const ly = bodyY + 18 + idx * Math.min(40, (bodyH - 16) / Math.max(1, items.length));
        bodySvg += `
          <circle cx="${lx}" cy="${ly - 4}" r="4.5" fill="${col}"/>
          <text x="${lx + 12}" y="${ly}" font-size="10.5" fill="${ink}" font-weight="600">${esc(it.label.slice(0, 18))}</text>
          <text x="${padX + bodyW}" y="${ly}" text-anchor="end" font-size="10.5" fill="${col}" font-weight="700">${esc(`${it.value}${it.unit || ''}`)}</text>
          <text x="${lx + 12}" y="${ly + 13}" font-size="9" fill="${ink}" fill-opacity="0.6">${esc((it.description || '').slice(0, 24))}</text>
        `;
      });
      break;
    }

    case 'esg_pillars':
    case 'network_mesh':
    case 'fact_sheet':
    case 'profile_data':
    default: {
      const n = Math.max(1, Math.min(3, items.length));
      const gap = 14;
      const colW = (bodyW - gap * (n - 1)) / n;
      items.slice(0, 3).forEach((it, idx) => {
        const px = padX + idx * (colW + gap);
        const col = paletteFor(data, idx);
        bodySvg += `
          <rect x="${px}" y="${bodyY}" width="${colW}" height="${bodyH}" rx="2" fill="${col}" fill-opacity="0.07" stroke="${col}" stroke-opacity="0.35"/>
          <rect x="${px}" y="${bodyY}" width="${colW}" height="6" fill="${col}"/>
          <text x="${px + 14}" y="${bodyY + 30}" font-size="10" fill="${col}" font-weight="700" letter-spacing="0.08em">${esc((it.category || `PILLAR 0${idx + 1}`).toUpperCase())}</text>
          <text x="${px + 14}" y="${bodyY + 64}" font-size="24" fill="${ink}" font-weight="700">${esc(`${it.value}${it.unit || ''}`)}</text>
          <text x="${px + 14}" y="${bodyY + 86}" font-size="11.5" fill="${ink}" font-weight="600">${esc(it.label.slice(0, 20))}</text>
          <text x="${px + 14}" y="${bodyY + 106}" font-size="9.5" fill="${ink}" fill-opacity="0.72">${esc((it.description || '').slice(0, 28))}</text>
        `;
      });
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="font-family:'${esc(font)}',sans-serif;">
    <rect x="0" y="0" width="${W}" height="${H}" fill="${bg}" stroke="${ink}" stroke-opacity="0.12" stroke-width="1"/>
    <text x="${padX}" y="24" font-size="9.5" fill="${accent}" font-weight="700" letter-spacing="0.14em">${esc(data.categoryLabel.toUpperCase())}</text>
    <text x="${padX}" y="46" font-size="18" fill="${ink}" font-weight="700">${esc(data.title)}</text>
    <text x="${padX}" y="63" font-size="10.5" fill="${ink}" fill-opacity="0.65">${esc(data.subtitle)}</text>
    <line x1="${padX}" y1="${headerH}" x2="${W - padX}" y2="${headerH}" stroke="${ink}" stroke-opacity="0.14" stroke-width="1"/>
    ${bodySvg}
    <text x="${padX}" y="${H - 10}" font-size="8.5" fill="${ink}" fill-opacity="0.5">${esc(data.sourceNote)}</text>
  </svg>`;
}
