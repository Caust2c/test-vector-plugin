const DEFAULT_COLORS = ["#38bdf8", "#f472b6", "#f59e0b", "#a78bfa", "#34d399", "#fb7185"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value) {
  if (Number.isInteger(value)) {
    return `${value}`;
  }

  return `${Math.round(value * 100) / 100}`;
}

function vectorMagnitude(components) {
  return Math.sqrt(components.reduce((sum, value) => sum + value * value, 0));
}

function addVectors(vectors) {
  const dimensions = vectors.reduce((max, vector) => Math.max(max, vector.components.length), 3);
  const total = Array.from({ length: dimensions }, () => 0);

  vectors.forEach((vector) => {
    vector.components.forEach((value, index) => {
      total[index] += Number(value) || 0;
    });
  });

  return total;
}

function normalizeVectorObject(vector, index) {
  const components = Array.isArray(vector.components) ? vector.components.slice(0, 3).map((value) => Number(value) || 0) : [0, 0, 0];

  while (components.length < 3) {
    components.push(0);
  }

  return {
    name: vector.name || vector.label || `v${index + 1}`,
    components,
    color: vector.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
    kind: vector.kind || "input",
  };
}

function extractJsonBlock(text) {
  const jsonBlock = text.match(/```json\s*([\s\S]*?)```/i);
  if (jsonBlock) {
    return jsonBlock[1].trim();
  }

  const objectBlock = text.match(/\{[\s\S]*\}$/);
  return objectBlock ? objectBlock[0] : null;
}

function extractExplanation(text) {
  const explanationMatch = text.match(/\*\*Explanation:\*\*([\s\S]*?)(?:\*\*Vector Specification:\*\*|\*\*Formal Specification:\*\*|$)/i);
  if (explanationMatch) {
    return explanationMatch[1].trim();
  }

  return text.split('\n\n')[0]?.trim() || '';
}

function parseLooseSpecification(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const vectors = [];
  let resultant = null;
  let title = '';
  let current = null;
  let inVectors = false;
  let inResultant = false;

  lines.forEach((line) => {
    if (/^title:/i.test(line)) {
      title = line.replace(/^title:/i, '').trim();
      return;
    }

    if (/^vectors:/i.test(line)) {
      inVectors = true;
      inResultant = false;
      current = null;
      return;
    }

    if (/^resultant:/i.test(line)) {
      inVectors = false;
      inResultant = true;
      current = null;
      return;
    }

    if (inVectors || inResultant) {
      const nameMatch = line.match(/^[-*]\s*name:\s*(.+)$/i);
      if (nameMatch) {
        current = { name: nameMatch[1].trim(), components: [0, 0, 0] };
        if (inVectors) {
          vectors.push(current);
        } else {
          resultant = current;
        }
        return;
      }

      const componentsMatch = line.match(/^components:\s*\[([^\]]+)\]/i);
      if (componentsMatch && current) {
        const components = componentsMatch[1]
          .split(',')
          .map((value) => Number(value.trim()) || 0);
        while (components.length < 3) {
          components.push(0);
        }
        current.components = components.slice(0, 3);
        return;
      }

      const colorMatch = line.match(/^color:\s*(.+)$/i);
      if (colorMatch && current) {
        current.color = colorMatch[1].trim();
      }
    }
  });

  return { title, vectors, resultant };
}

function parseVectorSpaceData(data) {
  if (typeof data === 'string') {
    const explanation = extractExplanation(data);
    const jsonText = extractJsonBlock(data);

    if (jsonText) {
      try {
        const parsed = JSON.parse(jsonText);
        return parseVectorSpaceData(parsed.explanation ? parsed : { explanation, vectorspace: parsed });
      } catch (error) {
        // Fall through to the loose parser below.
      }
    }

    const specStart = data.match(/\*\*Vector Specification:\*\*([\s\S]*)$/i);
    const specText = specStart ? specStart[1] : data;
    const loose = parseLooseSpecification(specText);
    return {
      explanation,
      vectorspace: {
        title: loose.title,
        vectors: loose.vectors,
        resultant: loose.resultant,
      },
    };
  }

  if (data && typeof data === 'object') {
    if (data.vectorspace) {
      return {
        explanation: data.explanation || '',
        vectorspace: data.vectorspace,
      };
    }

    return {
      explanation: data.explanation || '',
      vectorspace: data,
    };
  }

  return {
    explanation: '',
    vectorspace: {
      title: '3D Vector Space',
      vectors: [],
      resultant: null,
    },
  };
}

function createState(parsed) {
  const vectors = (parsed.vectorspace?.vectors || []).map(normalizeVectorObject);
  const resultantInput = parsed.vectorspace?.resultant ? normalizeVectorObject({ ...parsed.vectorspace.resultant, kind: 'resultant' }, vectors.length) : null;
  const derivedResultant = resultantInput || {
    name: 'r',
    components: addVectors(vectors),
    color: '#34d399',
    kind: 'resultant',
  };

  return {
    explanation: parsed.explanation || '',
    title: parsed.vectorspace?.title || '3D Vector Space',
    vectors,
    resultant: derivedResultant,
    rotationX: parsed.vectorspace?.rotation?.x ?? -0.45,
    rotationY: parsed.vectorspace?.rotation?.y ?? 0.8,
    zoom: parsed.vectorspace?.scale ?? 1,
    showAxes: true,
    showGrid: true,
  };
}

function projectPoint(point, state, width, height) {
  const cosY = Math.cos(state.rotationY);
  const sinY = Math.sin(state.rotationY);
  const cosX = Math.cos(state.rotationX);
  const sinX = Math.sin(state.rotationX);

  let x = point[0];
  let y = point[1];
  let z = point[2];

  const rotatedX = x * cosY + z * sinY;
  const rotatedZ = -x * sinY + z * cosY;

  x = rotatedX;
  z = rotatedZ;

  const rotatedY = y * cosX - z * sinX;
  const depth = y * sinX + z * cosX;

  y = rotatedY;

  const distance = 7;
  const perspective = distance / (distance - depth);
  const scale = Math.min(width, height) / 8 * state.zoom;

  return {
    x: width / 2 + x * scale * perspective,
    y: height / 2 - y * scale * perspective,
    depth,
    scale: scale * perspective,
  };
}

function drawArrow(context, start, end, color, label, width, height, state, isResultant = false) {
  const projectedStart = projectPoint(start, state, width, height);
  const projectedEnd = projectPoint(end, state, width, height);

  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = isResultant ? 4 : 2.5;
  context.shadowColor = color;
  context.shadowBlur = isResultant ? 16 : 8;
  context.beginPath();
  context.moveTo(projectedStart.x, projectedStart.y);
  context.lineTo(projectedEnd.x, projectedEnd.y);
  context.stroke();

  const angle = Math.atan2(projectedEnd.y - projectedStart.y, projectedEnd.x - projectedStart.x);
  const headLength = isResultant ? 16 : 12;
  context.beginPath();
  context.moveTo(projectedEnd.x, projectedEnd.y);
  context.lineTo(projectedEnd.x - headLength * Math.cos(angle - Math.PI / 6), projectedEnd.y - headLength * Math.sin(angle - Math.PI / 6));
  context.lineTo(projectedEnd.x - headLength * Math.cos(angle + Math.PI / 6), projectedEnd.y - headLength * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fill();

  context.shadowBlur = 0;
  context.font = isResultant ? '600 13px Inter, system-ui, sans-serif' : '12px Inter, system-ui, sans-serif';
  context.fillStyle = '#e2e8f0';
  context.fillText(label, projectedEnd.x + 8, projectedEnd.y - 8);
  context.restore();
}

function drawGrid(context, state, width, height) {
  const axisLength = 4.5;
  const ticks = 8;

  context.save();
  context.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  context.lineWidth = 1;

  for (let i = -ticks; i <= ticks; i += 1) {
    const offset = (i / ticks) * axisLength;
    const a = projectPoint([-axisLength, 0, offset], state, width, height);
    const b = projectPoint([axisLength, 0, offset], state, width, height);
    const c = projectPoint([offset, 0, -axisLength], state, width, height);
    const d = projectPoint([offset, 0, axisLength], state, width, height);

    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();

    context.beginPath();
    context.moveTo(c.x, c.y);
    context.lineTo(d.x, d.y);
    context.stroke();
  }

  context.restore();
}

function drawAxes(context, state, width, height) {
  drawArrow(context, [0, 0, 0], [4.5, 0, 0], '#f87171', 'x', width, height, state);
  drawArrow(context, [0, 0, 0], [0, 4.5, 0], '#60a5fa', 'y', width, height, state);
  drawArrow(context, [0, 0, 0], [0, 0, 4.5], '#fbbf24', 'z', width, height, state);
}

function drawScene(canvas, state) {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#08111f');
  gradient.addColorStop(1, '#0f172a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.save();
  context.fillStyle = 'rgba(15, 23, 42, 0.55)';
  context.fillRect(0, 0, width, height);
  context.restore();

  if (state.showGrid) {
    drawGrid(context, state, width, height);
  }

  if (state.showAxes) {
    drawAxes(context, state, width, height);
  }

  const sortedVectors = [...state.vectors, state.resultant].sort((left, right) => vectorMagnitude(left.components) - vectorMagnitude(right.components));

  sortedVectors.forEach((vector) => {
    drawArrow(
      context,
      [0, 0, 0],
      vector.components,
      vector.color,
      `${vector.name} = (${vector.components.map(formatNumber).join(', ')})`,
      width,
      height,
      state,
      vector.kind === 'resultant',
    );
  });
}

function createSliderRow(label, value, min, max, step, onChange) {
  const row = document.createElement('label');
  row.className = 'vectorspace-slider';
  row.innerHTML = `
    <span class="vectorspace-slider-label">${label}</span>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${value}">
    <span class="vectorspace-slider-value">${formatNumber(value)}</span>
  `;

  const input = row.querySelector('input');
  const output = row.querySelector('.vectorspace-slider-value');
  input.addEventListener('input', () => {
    const nextValue = Number(input.value);
    output.textContent = formatNumber(nextValue);
    onChange(nextValue);
  });

  return row;
}

function renderVectorControls(container, state, refresh) {
  const controls = document.createElement('div');
  controls.className = 'vectorspace-controls';

  state.vectors.forEach((vector) => {
    const card = document.createElement('div');
    card.className = 'vectorspace-card';
    card.innerHTML = `
      <div class="vectorspace-card-header">
        <span class="vectorspace-chip" style="background:${vector.color}"></span>
        <strong>${vector.name}</strong>
      </div>
    `;

    ['x', 'y', 'z'].forEach((axis, axisIndex) => {
      const slider = createSliderRow(
        axis.toUpperCase(),
        vector.components[axisIndex],
        -8,
        8,
        0.1,
        (nextValue) => {
          vector.components[axisIndex] = nextValue;
          state.resultant.components = addVectors(state.vectors);
          refresh();
        },
      );
      card.appendChild(slider);
    });

    controls.appendChild(card);
  });

  const viewCard = document.createElement('div');
  viewCard.className = 'vectorspace-card';
  viewCard.innerHTML = `
    <div class="vectorspace-card-header">
      <strong>View</strong>
    </div>
  `;

  viewCard.appendChild(createSliderRow('Rotate X', Math.round(state.rotationX * 100) / 100, -Math.PI, Math.PI, 0.01, (value) => {
    state.rotationX = value;
    refresh();
  }));
  viewCard.appendChild(createSliderRow('Rotate Y', Math.round(state.rotationY * 100) / 100, -Math.PI, Math.PI, 0.01, (value) => {
    state.rotationY = value;
    refresh();
  }));
  viewCard.appendChild(createSliderRow('Zoom', state.zoom, 0.5, 2.5, 0.01, (value) => {
    state.zoom = value;
    refresh();
  }));

  const toggleRow = document.createElement('div');
  toggleRow.className = 'vectorspace-toggle-row';
  toggleRow.innerHTML = `
    <label><input type="checkbox" checked> Axes</label>
    <label><input type="checkbox" checked> Grid</label>
  `;

  const axesToggle = toggleRow.querySelectorAll('input')[0];
  const gridToggle = toggleRow.querySelectorAll('input')[1];
  axesToggle.addEventListener('change', () => {
    state.showAxes = axesToggle.checked;
    refresh();
  });
  gridToggle.addEventListener('change', () => {
    state.showGrid = gridToggle.checked;
    refresh();
  });

  viewCard.appendChild(toggleRow);
  controls.appendChild(viewCard);

  const summary = document.createElement('div');
  summary.className = 'vectorspace-summary';
  const resultantMagnitude = vectorMagnitude(state.resultant.components);
  summary.innerHTML = `
    <div class="vectorspace-summary-title">Final answer vector</div>
    <div class="vectorspace-summary-vector">${state.resultant.name} = (${state.resultant.components.map(formatNumber).join(', ')})</div>
    <div class="vectorspace-summary-meta">|${state.resultant.name}| = ${formatNumber(resultantMagnitude)}</div>
  `;

  container.appendChild(controls);
  container.appendChild(summary);
}

export async function renderVectorSpace(data, container) {
  try {
    const parsed = parseVectorSpaceData(data);
    const state = createState(parsed);

    if (!state.vectors.length && !state.resultant) {
      throw new Error('No vectors found in vector specification');
    }

    container.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = `
      .vectorspace-plugin {
        display: grid;
        gap: 18px;
        color: #e2e8f0;
        font-family: Inter, system-ui, sans-serif;
      }

      .vectorspace-header {
        display: grid;
        gap: 8px;
      }

      .vectorspace-header h2 {
        margin: 0;
        font-size: 1.3rem;
        color: #f8fafc;
      }

      .vectorspace-header p {
        margin: 0;
        color: #cbd5e1;
        line-height: 1.5;
      }

      .vectorspace-stage {
        display: grid;
        grid-template-columns: minmax(320px, 1.4fr) minmax(280px, 0.9fr);
        gap: 16px;
        align-items: start;
      }

      .vectorspace-canvas-shell {
        position: relative;
        min-height: 540px;
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 20px;
        overflow: hidden;
        background: radial-gradient(circle at top, rgba(56, 189, 248, 0.16), transparent 35%), linear-gradient(180deg, #0f172a, #020617);
        box-shadow: 0 24px 70px rgba(2, 6, 23, 0.45);
      }

      .vectorspace-canvas-shell canvas {
        display: block;
        width: 100%;
        height: 540px;
        cursor: grab;
      }

      .vectorspace-overlay {
        position: absolute;
        left: 16px;
        top: 16px;
        display: grid;
        gap: 6px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(15, 23, 42, 0.65);
        border: 1px solid rgba(148, 163, 184, 0.15);
        backdrop-filter: blur(10px);
      }

      .vectorspace-overlay span {
        font-size: 0.82rem;
        color: #cbd5e1;
      }

      .vectorspace-controls {
        display: grid;
        gap: 14px;
      }

      .vectorspace-card,
      .vectorspace-summary {
        padding: 16px;
        border-radius: 18px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        background: rgba(15, 23, 42, 0.88);
        box-shadow: 0 16px 40px rgba(2, 6, 23, 0.25);
      }

      .vectorspace-card-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
      }

      .vectorspace-chip {
        width: 11px;
        height: 11px;
        border-radius: 999px;
        box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.05);
      }

      .vectorspace-slider {
        display: grid;
        grid-template-columns: 54px 1fr 48px;
        gap: 10px;
        align-items: center;
        margin-top: 8px;
      }

      .vectorspace-slider-label,
      .vectorspace-slider-value,
      .vectorspace-toggle-row label,
      .vectorspace-summary-meta {
        font-size: 0.84rem;
        color: #cbd5e1;
      }

      .vectorspace-slider input[type="range"] {
        width: 100%;
      }

      .vectorspace-toggle-row {
        display: flex;
        gap: 12px;
        margin-top: 12px;
        flex-wrap: wrap;
      }

      .vectorspace-summary-title {
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-size: 0.74rem;
        color: #94a3b8;
        margin-bottom: 8px;
      }

      .vectorspace-summary-vector {
        font-size: 1rem;
        font-weight: 700;
        color: #f8fafc;
      }

      .vectorspace-summary-meta {
        margin-top: 8px;
      }

      @media (max-width: 900px) {
        .vectorspace-stage {
          grid-template-columns: 1fr;
        }
      }
    `;

    const plugin = document.createElement('div');
    plugin.className = 'vectorspace-plugin';

    const header = document.createElement('div');
    header.className = 'vectorspace-header';
    header.innerHTML = `
      <h2>${state.title}</h2>
      <p>${state.explanation || 'Drag the canvas to rotate the view. Use the sliders to change the vectors and watch the final answer update immediately.'}</p>
    `;

    const stage = document.createElement('div');
    stage.className = 'vectorspace-stage';

    const canvasShell = document.createElement('div');
    canvasShell.className = 'vectorspace-canvas-shell';

    const canvas = document.createElement('canvas');
    canvas.width = 980;
    canvas.height = 540;

    const overlay = document.createElement('div');
    overlay.className = 'vectorspace-overlay';
    overlay.innerHTML = `
      <span>Interactive 3D vectors</span>
      <span>Drag to rotate • Scroll to zoom</span>
    `;

    canvasShell.appendChild(canvas);
    canvasShell.appendChild(overlay);

    const sidePanel = document.createElement('div');

    function refresh() {
      drawScene(canvas, state);
      sidePanel.innerHTML = '';
      renderVectorControls(sidePanel, state, refresh);
    }

    let dragActive = false;
    let lastPointerX = 0;
    let lastPointerY = 0;

    canvas.addEventListener('pointerdown', (event) => {
      dragActive = true;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!dragActive) {
        return;
      }

      const deltaX = event.clientX - lastPointerX;
      const deltaY = event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;

      state.rotationY += deltaX * 0.01;
      state.rotationX = clamp(state.rotationX + deltaY * 0.01, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
      refresh();
    });

    const endDrag = () => {
      dragActive = false;
      canvas.style.cursor = 'grab';
    };

    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointerleave', endDrag);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      state.zoom = clamp(state.zoom + (event.deltaY > 0 ? -0.05 : 0.05), 0.5, 2.5);
      refresh();
    }, { passive: false });

    stage.appendChild(canvasShell);
    stage.appendChild(sidePanel);

    plugin.appendChild(header);
    plugin.appendChild(stage);

    container.appendChild(style);
    container.appendChild(plugin);

    refresh();
  } catch (error) {
    container.innerHTML = `
      <div class="vectorspace-error">
        <p>Error rendering vector space: ${error.message}</p>
      </div>
    `;
  }
}

export async function render(data, container) {
  return renderVectorSpace(data, container);
}

export default renderVectorSpace;